import { create } from 'zustand'
import { createCrystalStore, useCrystalStore } from './crystalStore'
import type { StoreApi, UseBoundStore } from 'zustand'

// ── Layout ─────────────────────────────────────────────────────────
export type GridLayout = '1x1' | '1x2' | '2x2' | '2x3' | '2x4' | '3x4' | '4x4'

export interface GridSpec {
  cols: number
  rows: number
  total: number
}

export const GRID_SPECS: Record<GridLayout, GridSpec> = {
  '1x1': { cols: 1, rows: 1, total: 1 },
  '1x2': { cols: 2, rows: 1, total: 2 },
  '2x2': { cols: 2, rows: 2, total: 4 },
  '2x3': { cols: 3, rows: 2, total: 6 },
  '2x4': { cols: 4, rows: 2, total: 8 },
  '3x4': { cols: 4, rows: 3, total: 12 },
  '4x4': { cols: 4, rows: 4, total: 16 },
}

/**
 * Layouts ordered by slot count. Two callers need "the smallest grid that
 * fits N panes": opening a chart (grow until a free slot exists) and planning
 * a batch mount. Deriving it from GRID_SPECS keeps the order honest when a
 * layout is added.
 */
export const LAYOUTS_BY_CAPACITY: readonly GridLayout[] = (Object.keys(GRID_SPECS) as GridLayout[])
  .slice()
  .sort((left, right) => GRID_SPECS[left].total - GRID_SPECS[right].total)

// ── Free layout mode (main viewport + dynamic sub-viewport strip) ──
/** Sub-viewport placement: right column, bottom row, or L shape (fill right first, then bottom). */
export type FreePlacement = 'right' | 'bottom' | 'l-shape'

export interface FreeLayoutState {
  placement: FreePlacement
  /** Main viewport occupying the large area. */
  mainViewportId: string
  /** Sub-viewport render order. */
  subViewportIds: string[]
  /** Right sub-viewport column width as a fraction of the total width, updated by dragging the divider. */
  rightSize: number
  /** Bottom sub-viewport row height as a fraction of the total height, updated by dragging the divider. */
  bottomSize: number
}

/** Sub-viewport limit: three in the right column plus five in the bottom row; more would be unusably small. */
export const MAX_SUB_VIEWPORTS = 8

export const DEFAULT_FREE_RIGHT_SIZE = 0.28
export const DEFAULT_FREE_BOTTOM_SIZE = 0.3
/** Sub-viewport strip size range: smaller is hard to interact with, while larger overwhelms the main viewport. */
export const MIN_FREE_SPLIT = 0.12
export const MAX_FREE_SPLIT = 0.6

function clampFreeSize(size: number, fallback: number): number {
  if (!Number.isFinite(size)) return fallback
  return Math.min(MAX_FREE_SPLIT, Math.max(MIN_FREE_SPLIT, size))
}

// ── Viewport Slot ─────────────────────────────────────────────────
/**
 * Slot kinds. `crystal` is the standard 3D viewport with its own crystalStore;
 * `chart` is a live result viewport that reads from another crystal slot and
 * renders a 2D chart (RDF / XRD / …). Chart slots do not own a crystalStore.
 */
export type ViewportSlotKind = 'crystal' | 'chart'

/**
 * `ladder` is a drill-down view. Like the other chart kinds, it is a 2D
 * companion that reads from a crystal source without owning a store, so it
 * uses the same slot mechanism instead of adding another ViewportSlotKind.
 * A third kind would leave every `!isChart` branch in ViewportCell incomplete.
 */
export type ChartKind = 'rdf' | 'xrd' | 'ediff' | 'convergence' | 'ladder'

export interface CrystalSlot {
  id: string
  kind: 'crystal'
  label: string
  storeInstance: UseBoundStore<StoreApi<ReturnType<typeof createCrystalStore>['getState']>>
  structureName: string | null
}

export interface ChartSlot {
  id: string
  kind: 'chart'
  label: string
  chartKind: ChartKind
  /** Crystal slot whose atoms / lattice feed this chart. */
  sourceViewportId: string
}

export type ViewportSlot = CrystalSlot | ChartSlot

// ── Type helper for a CrystalStore instance ───────────────────────
type CrystalStoreHook = ReturnType<typeof createCrystalStore>

// ── ViewportManager ───────────────────────────────────────────────
/**
 * Column divider position, expressed as the width fraction occupied by the
 * **first column**.
 *
 * Store one value for the column direction only. The current drag use case is
 * a side-by-side 3D viewport and companion panel, where ladder and chart views
 * may otherwise be too narrow or too wide. Per-divider ratios would be unused
 * generalization until independently adjustable columns are required.
 */
export const DEFAULT_COLUMN_SPLIT = 0.5
/** Keep at least 15% on each side; anything narrower makes either pane unusable. */
export const MIN_COLUMN_SPLIT = 0.15
export const MAX_COLUMN_SPLIT = 0.85

/** Clamp arbitrary input to the usable range; NaN falls back to an even split. */
export function clampColumnSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_COLUMN_SPLIT
  return Math.min(MAX_COLUMN_SPLIT, Math.max(MIN_COLUMN_SPLIT, ratio))
}

interface ViewportManagerState {
  layout: GridLayout
  activeViewportId: string
  viewports: Record<string, ViewportSlot>
  /** First-column width fraction, updated by dragging the divider. */
  columnSplit: number
  /** Set the column split ratio, clamped internally to [MIN, MAX]. */
  setColumnSplit: (ratio: number) => void

  /**
   * Viewport shown exclusively in maximized mode. null means the normal grid.
   *
   * This is display-only state and does not modify layout or viewports. An
   * earlier 1x1-based implementation removed the other slots through setLayout,
   * losing their mounted content when maximized mode ended.
   */
  maximizedViewportId: string | null
  /** Enter or leave maximized mode; passing the maximized id exits it. */
  toggleMaximized: (vpId: string) => void

  /**
   * Free layout mode (main viewport + dynamic sub-viewport strip). null means
   * the regular grid.
   *
   * This remains separate from the GridLayout union because free mode has a
   * dynamic slot count. Adding it to GRID_SPECS would require every
   * `GRID_SPECS[layout]` lookup to handle a missing value. Grid and free modes
   * are mutually exclusive, so setLayout clears this state.
   */
  freeLayout: FreeLayoutState | null
  /** Enter free mode with the active viewport as main and the other visible slots as ordered sub-viewports. */
  enterFreeMode: (placement?: FreePlacement) => void
  /** Return to the previous grid layout, caching excess sub-viewports in detachedSlots. */
  exitFreeMode: () => void
  /** Change the sub-viewport strip placement. */
  setFreePlacement: (placement: FreePlacement) => void
  /** Append a sub-viewport, restoring from detachedSlots first; return null at the limit. */
  addSubViewport: () => string | null
  /** Remove a sub-viewport into detachedSlots, preserving content like a grid shrink. */
  removeSubViewport: (vpId: string) => void
  /** Swap a sub-viewport with the main viewport by id without copying stores or content. */
  swapWithMain: (vpId: string) => void
  /** Resize the split: right controls column width and bottom controls row height. */
  setFreeSplit: (axis: 'right' | 'bottom', size: number) => void

  setLayout: (layout: GridLayout) => void
  setActive: (vpId: string) => void
  getActiveStore: () => CrystalStoreHook
  getViewportStore: (vpId: string) => CrystalStoreHook | null
  setStructureName: (vpId: string, name: string | null) => void
  /**
   * Open a live chart slot of `chartKind` showing analysis of `sourceVpId`'s
   * structure. If the layout is currently 1x1 we split to 1x2 and place the
   * chart in the new second slot. If a chart slot of the same kind already
   * exists for this source, it's reused (toggled active). Returns the chart
   * slot id (or null if open failed).
   */
  openChartSlot: (chartKind: ChartKind, sourceVpId?: string) => string | null
  /** Replace a chart slot with a fresh crystal slot (or shrink to 1x1 if last). */
  closeChartSlot: (slotId: string) => void
}

function makeViewportId(index: number): string {
  return `vp-${index + 1}`
}

function createCrystalSlot(index: number): CrystalSlot {
  const id = makeViewportId(index)
  return {
    id,
    kind: 'crystal',
    label: `VP-${index + 1}`,
    storeInstance: createCrystalStore() as unknown as CrystalSlot['storeInstance'],
    structureName: null,
  }
}

/**
 * Slots removed from the grid when a layout shrinks.
 *
 * This previously called store.destroy() directly, so switching from 2x4 to
 * 1x1 and back recreated vp-2 through vp-8 as empty stores. Their structures
 * were deleted rather than merely hidden. Caching preserves the original slots
 * when the layout grows again, at the cost of retaining them in memory until
 * the user explicitly clears them or changes documents.
 */
const detachedSlots = new Map<string, ViewportSlot>()

function buildViewports(count: number, existing: Record<string, ViewportSlot>): Record<string, ViewportSlot> {
  const result: Record<string, ViewportSlot> = {}
  for (let i = 0; i < count; i++) {
    const id = makeViewportId(i)
    // Prefer a slot still in the grid, then a detached slot, then a new slot.
    const restored = existing[id] ?? detachedSlots.get(id)
    if (restored) detachedSlots.delete(id)
    result[id] = restored ?? createCrystalSlot(i)
  }
  return result
}

/**
 * Acquire a slot that does not conflict with an existing viewport. Restore
 * detachedSlots in index order first so previously mounted content remains
 * recoverable; otherwise create a new slot. This matches buildViewports.
 */
function acquireSlot(existing: Record<string, ViewportSlot>): ViewportSlot {
  for (let i = 0; ; i++) {
    const id = makeViewportId(i)
    if (existing[id]) continue
    const restored = detachedSlots.get(id)
    if (restored) {
      detachedSlots.delete(id)
      return restored
    }
    return createCrystalSlot(i)
  }
}

function chartLabel(kind: ChartKind): string {
  switch (kind) {
    case 'rdf': return 'g(r)'
    case 'xrd': return 'XRD'
    case 'ediff': return 'eDiff'
    case 'convergence': return 'E/F'
    case 'ladder': return 'Ladder'
  }
}

export const useViewportManager = create<ViewportManagerState>((set, get) => {
  // VP-1 uses the global useCrystalStore singleton so existing 1x1 panels require no changes.
  const initialSlot: CrystalSlot = {
    id: makeViewportId(0),
    kind: 'crystal',
    label: 'VP-1',
    storeInstance: useCrystalStore as unknown as CrystalSlot['storeInstance'],
    structureName: null,
  }

  return {
    layout: '1x1',
    activeViewportId: initialSlot.id,
    viewports: { [initialSlot.id]: initialSlot },
    columnSplit: DEFAULT_COLUMN_SPLIT,
    maximizedViewportId: null,
    freeLayout: null,

    setColumnSplit: (ratio) => set({ columnSplit: clampColumnSplit(ratio) }),

    enterFreeMode: (placement = 'right') => {
      const state = get()
      if (state.freeLayout) {
        // Already in free mode: change placement without reordering the main/sub relationship.
        set({ freeLayout: { ...state.freeLayout, placement } })
        return
      }
      // setActive guarantees that the active slot is a crystal slot, so it can become main directly.
      const mainViewportId = state.activeViewportId
      const viewports = { ...state.viewports }
      const subViewportIds = Object.keys(viewports).filter((id) => id !== mainViewportId)
      // A main-only free layout is equivalent to 1x1, so ensure at least one sub-viewport.
      if (subViewportIds.length === 0) {
        const slot = acquireSlot(viewports)
        viewports[slot.id] = slot
        subViewportIds.push(slot.id)
      }
      set({
        freeLayout: {
          placement,
          mainViewportId,
          subViewportIds,
          rightSize: DEFAULT_FREE_RIGHT_SIZE,
          bottomSize: DEFAULT_FREE_BOTTOM_SIZE,
        },
        viewports,
        // A maximized viewport would cover the free layout, so leave maximized mode on entry.
        maximizedViewportId: null,
      })
    },

    exitFreeMode: () => {
      const state = get()
      if (!state.freeLayout) return
      // The main viewport may have been swapped with a high-index slot such as vp-5.
      // The restored grid must contain it, or setLayout would cache the visible main
      // viewport and make its content appear to vanish.
      const mainIndex = Number(state.freeLayout.mainViewportId.replace('vp-', ''))
      const fits = (l: GridLayout) => GRID_SPECS[l].total >= mainIndex
      const layout = fits(state.layout)
        ? state.layout
        : (LAYOUTS_BY_CAPACITY.find(fits) ?? state.layout)
      set({ freeLayout: null, activeViewportId: state.freeLayout.mainViewportId })
      // Reuse setLayout's shrink behavior to cache slots beyond grid capacity in detachedSlots.
      get().setLayout(layout)
    },

    setFreePlacement: (placement) => {
      const state = get()
      if (!state.freeLayout) return
      set({ freeLayout: { ...state.freeLayout, placement } })
    },

    addSubViewport: () => {
      const state = get()
      if (!state.freeLayout) return null
      if (state.freeLayout.subViewportIds.length >= MAX_SUB_VIEWPORTS) return null
      const slot = acquireSlot(state.viewports)
      set({
        viewports: { ...state.viewports, [slot.id]: slot },
        freeLayout: {
          ...state.freeLayout,
          subViewportIds: [...state.freeLayout.subViewportIds, slot.id],
        },
      })
      return slot.id
    },

    removeSubViewport: (vpId) => {
      const state = get()
      const free = state.freeLayout
      if (!free || !free.subViewportIds.includes(vpId)) return
      // Keep the final sub-viewport; use the 1x1 grid for a main-only layout.
      if (free.subViewportIds.length <= 1) return
      const slot = state.viewports[vpId]
      if (!slot) return
      // Match grid-shrink semantics: cache crystal slots for recovery and discard derived chart slots.
      if (slot.kind === 'crystal') detachedSlots.set(vpId, slot)
      const viewports = { ...state.viewports }
      delete viewports[vpId]
      const activeViewportId =
        state.activeViewportId === vpId ? free.mainViewportId : state.activeViewportId
      set({
        viewports,
        activeViewportId,
        freeLayout: {
          ...free,
          subViewportIds: free.subViewportIds.filter((id) => id !== vpId),
        },
        maximizedViewportId: state.maximizedViewportId === vpId ? null : state.maximizedViewportId,
      })
    },

    setFreeSplit: (axis, size) => {
      const free = get().freeLayout
      if (!free) return
      if (axis === 'right') {
        set({ freeLayout: { ...free, rightSize: clampFreeSize(size, DEFAULT_FREE_RIGHT_SIZE) } })
      } else {
        set({ freeLayout: { ...free, bottomSize: clampFreeSize(size, DEFAULT_FREE_BOTTOM_SIZE) } })
      }
    },

    swapWithMain: (vpId) => {
      const state = get()
      const free = state.freeLayout
      if (!free || !free.subViewportIds.includes(vpId)) return
      const previousMain = free.mainViewportId
      const swapped = free.subViewportIds.map((id) => (id === vpId ? previousMain : id))
      const promoted = state.viewports[vpId]
      set({
        freeLayout: { ...free, mainViewportId: vpId, subViewportIds: swapped },
        // Promote a crystal slot to active with the main position; charts cannot become active.
        ...(promoted?.kind === 'crystal' ? { activeViewportId: vpId } : {}),
      })
    },

    toggleMaximized: (vpId) => {
      const state = get()
      if (state.maximizedViewportId === vpId) {
        set({ maximizedViewportId: null })
        return
      }
      if (!state.viewports[vpId]) return
      // Make a maximized crystal viewport active so the viewport filling the screen remains editable.
      set({
        maximizedViewportId: vpId,
        ...(state.viewports[vpId].kind === 'crystal' ? { activeViewportId: vpId } : {}),
      })
    },

    setLayout: (layout) => {
      const spec = GRID_SPECS[layout]
      const existing = get().viewports
      const viewports = buildViewports(spec.total, existing)

      // Cache slots removed from the grid instead of destroying them so larger layouts restore their content.
      for (const id of Object.keys(existing)) {
        if (!viewports[id]) detachedSlots.set(id, existing[id])
      }

      let activeViewportId = get().activeViewportId
      // Active viewport must remain a crystal slot. If it was removed or is
      // now a chart slot, fall back to the first crystal slot.
      const currentActive = viewports[activeViewportId]
      if (!currentActive || currentActive.kind !== 'crystal') {
        const firstCrystal = Object.values(viewports).find((s) => s.kind === 'crystal')
        activeViewportId = firstCrystal?.id ?? makeViewportId(0)
      }

      // Reset the divider when changing layouts. A ratio tuned for 1x2 may make
      // one column too narrow in 4x4, without the user expecting it to persist.
      const maximized = get().maximizedViewportId
      set({
        layout,
        viewports,
        activeViewportId,
        columnSplit: DEFAULT_COLUMN_SPLIT,
        // Grid and free modes are mutually exclusive; setting a grid layout exits free mode, including agent calls.
        freeLayout: null,
        // Leave maximized mode when changing layouts so a stale exclusive viewport does not hide the new grid.
        maximizedViewportId: maximized && viewports[maximized] ? maximized : null,
      })
    },

    setActive: (vpId) => {
      const slot = get().viewports[vpId]
      // Chart slots aren't activatable — only crystal slots receive 3D edits.
      if (slot && slot.kind === 'crystal') {
        set({ activeViewportId: vpId })
      }
    },

    getActiveStore: () => {
      const { activeViewportId, viewports } = get()
      const slot = viewports[activeViewportId]
      if (!slot || slot.kind !== 'crystal') {
        return useCrystalStore as unknown as CrystalStoreHook
      }
      return slot.storeInstance as unknown as CrystalStoreHook
    },

    getViewportStore: (vpId) => {
      const slot = get().viewports[vpId]
      if (!slot || slot.kind !== 'crystal') return null
      return slot.storeInstance as unknown as CrystalStoreHook
    },

    setStructureName: (vpId, name) => {
      const slot = get().viewports[vpId]
      if (!slot || slot.kind !== 'crystal') return
      set({
        viewports: {
          ...get().viewports,
          [vpId]: { ...slot, structureName: name },
        },
      })
    },

    openChartSlot: (chartKind, sourceVpId) => {
      const state = get()
      const source = sourceVpId ?? state.activeViewportId
      const sourceSlot = state.viewports[source]
      if (!sourceSlot || sourceSlot.kind !== 'crystal') return null

      // Reuse existing chart slot for the same source+kind if present.
      const existingChart = Object.values(state.viewports).find(
        (s): s is ChartSlot => s.kind === 'chart' && s.chartKind === chartKind && s.sourceViewportId === source,
      )
      if (existingChart) return existingChart.id

      // In free mode, append a chart sub-viewport directly instead of growing the grid.
      if (state.freeLayout) {
        if (state.freeLayout.subViewportIds.length >= MAX_SUB_VIEWPORTS) return null
        const acquired = acquireSlot(state.viewports)
        // A restored crystal slot may contain data; return it to the cache because chart slots own no store.
        if (acquired.kind === 'crystal' && acquired.storeInstance !== (useCrystalStore as unknown)) {
          detachedSlots.set(acquired.id, acquired)
        }
        const chartSlot: ChartSlot = {
          id: acquired.id,
          kind: 'chart',
          label: chartLabel(chartKind),
          chartKind,
          sourceViewportId: source,
        }
        set({
          viewports: { ...state.viewports, [chartSlot.id]: chartSlot },
          freeLayout: {
            ...state.freeLayout,
            subViewportIds: [...state.freeLayout.subViewportIds, chartSlot.id],
          },
          activeViewportId: source,
        })
        return chartSlot.id
      }

      // Grow the grid until a non-source crystal slot is free for the chart.
      // Each chart owns a slot, so a second analysis on the same structure
      // needs one more slot than the first: 1x1 → 1x2 → 2x2 → … Previously
      // this only promoted 1x1 → 1x2 and then bailed out, so once a chart
      // occupied the second pane every other analysis button looked dead.
      const ladderStart = Math.max(0, LAYOUTS_BY_CAPACITY.indexOf(state.layout))
      let targetLayout: GridLayout | null = null
      let nextViewports: Record<string, ViewportSlot> = {}
      let targetEntry: CrystalSlot | undefined

      for (let li = ladderStart; li < LAYOUTS_BY_CAPACITY.length; li++) {
        const candidate = LAYOUTS_BY_CAPACITY[li]
        const built: Record<string, ViewportSlot> = { ...state.viewports }
        for (let i = 0; i < GRID_SPECS[candidate].total; i++) {
          const id = makeViewportId(i)
          if (!built[id]) built[id] = createCrystalSlot(i)
        }
        // Only panes visible in this candidate layout count as usable.
        for (let i = 0; i < GRID_SPECS[candidate].total; i++) {
          const slot = built[makeViewportId(i)]
          if (slot && slot.id !== source && slot.kind === 'crystal') {
            targetEntry = slot
            break
          }
        }
        if (targetEntry) {
          targetLayout = candidate
          nextViewports = built
          break
        }
      }
      // Grid is at 4x4 and every pane holds a chart or the source structure.
      if (!targetLayout || !targetEntry) return null

      // If replacing a crystal slot, release its store first.
      if (targetEntry.storeInstance !== (useCrystalStore as unknown)) {
        const store = targetEntry.storeInstance as any
        if (typeof store.destroy === 'function') store.destroy()
      }

      const chartSlot: ChartSlot = {
        id: targetEntry.id,
        kind: 'chart',
        label: chartLabel(chartKind),
        chartKind,
        sourceViewportId: source,
      }
      nextViewports[chartSlot.id] = chartSlot

      set({ layout: targetLayout, viewports: nextViewports, activeViewportId: source })
      return chartSlot.id
    },

    closeChartSlot: (slotId) => {
      const state = get()
      const slot = state.viewports[slotId]
      if (!slot || slot.kind !== 'chart') return
      // In free mode, closing a chart removes its sub-viewport and lets the rest reflow.
      // If it was swapped into the main position, swap in the first sub-viewport before removal.
      if (state.freeLayout) {
        if (state.freeLayout.mainViewportId === slotId) {
          const firstSub = state.freeLayout.subViewportIds[0]
          if (!firstSub) return
          get().swapWithMain(firstSub)
        }
        const free = get().freeLayout
        if (free && free.subViewportIds.length <= 1) {
          // If this is the final sub-viewport, remove it and return the main viewport to grid mode.
          const viewports = { ...get().viewports }
          delete viewports[slotId]
          set({ viewports, freeLayout: null })
          get().setLayout(get().layout)
          return
        }
        get().removeSubViewport(slotId)
        return
      }
      // Count remaining chart slots before removal.
      const remainingCharts = Object.values(state.viewports).filter(
        (s) => s.kind === 'chart' && s.id !== slotId,
      ).length
      // If this was the only chart and we have just 2 slots (1x2 we opened),
      // shrink back to 1x1 to keep the UI tidy.
      if (state.layout === '1x2' && remainingCharts === 0) {
        // Remove the chart slot; setLayout will rebuild the crystal slot.
        const trimmed: Record<string, ViewportSlot> = {}
        for (const [id, s] of Object.entries(state.viewports)) {
          if (s.kind === 'crystal') trimmed[id] = s
        }
        set({ viewports: trimmed })
        get().setLayout('1x1')
        return
      }
      // Otherwise replace the chart slot with a fresh crystal slot.
      const index = Object.keys(state.viewports).indexOf(slotId)
      const replacement = createCrystalSlot(Math.max(0, index))
      // Keep the same id so the grid position is stable.
      replacement.id = slotId
      // createCrystalSlot already assigns the `VP-N` label from the index. A
      // previous /g\(r\)|XRD|eDiff|E\/F/ rewrite duplicated that responsibility
      // and required updates for every new ChartKind; omissions left labels such
      // as "Ladder" on restored 3D viewports. Keep createCrystalSlot as the sole
      // source of crystal-slot labels.
      set({
        viewports: { ...state.viewports, [slotId]: replacement },
      })
    },
  }
})

/**
 * Complete reversible layout boundary, including panes temporarily detached
 * by a shrink/free-layout transition. Keeping this state in one module is
 * essential: callers cannot safely reconstruct the private detached cache
 * from the currently visible viewport record.
 */
export interface ViewportManagerTransactionSnapshot {
  layout: GridLayout
  activeViewportId: string
  viewports: Record<string, ViewportSlot>
  columnSplit: number
  maximizedViewportId: string | null
  freeLayout: FreeLayoutState | null
  detached: Array<[string, ViewportSlot]>
}

export function captureViewportManagerTransaction(): ViewportManagerTransactionSnapshot {
  const state = useViewportManager.getState()
  return {
    layout: state.layout,
    activeViewportId: state.activeViewportId,
    viewports: state.viewports,
    columnSplit: state.columnSplit,
    maximizedViewportId: state.maximizedViewportId,
    freeLayout: state.freeLayout ? {
      ...state.freeLayout,
      subViewportIds: [...state.freeLayout.subViewportIds],
    } : null,
    detached: [...detachedSlots.entries()],
  }
}

export function restoreViewportManagerTransaction(snapshot: ViewportManagerTransactionSnapshot): void {
  detachedSlots.clear()
  for (const [id, slot] of snapshot.detached) detachedSlots.set(id, slot)
  useViewportManager.setState({
    layout: snapshot.layout,
    activeViewportId: snapshot.activeViewportId,
    viewports: snapshot.viewports,
    columnSplit: snapshot.columnSplit,
    maximizedViewportId: snapshot.maximizedViewportId,
    freeLayout: snapshot.freeLayout ? {
      ...snapshot.freeLayout,
      subViewportIds: [...snapshot.freeLayout.subViewportIds],
    } : null,
  })
}
