import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Plus, X } from 'lucide-react'
import {
  useViewportManager,
  GRID_SPECS,
  MAX_SUB_VIEWPORTS,
  DEFAULT_FREE_RIGHT_SIZE,
  DEFAULT_FREE_BOTTOM_SIZE,
  MIN_FREE_SPLIT,
  MAX_FREE_SPLIT,
  type FreeLayoutState,
  type ViewportSlot,
} from '../../../orchestration/viewportManager'
import { ViewportCell } from './ViewportCell'
import { ChartViewport } from './ChartViewport'
import { LayoutSwitcher } from './LayoutSwitcher'
import { ColumnDivider } from './ColumnDivider'
import { resolveViewportTheme, useThemeStore } from '../../../host'
import { useViewportStore } from '../../../orchestration/ViewportContext'
import { cn } from '../../../ui-kit/utils'

const CrystalViewer = lazy(() =>
  import('../crystal-viewer').then(m => ({ default: m.CrystalViewer }))
)

function ViewportFallback() {
  const background = useViewportStore((state) => state.background)
  const isDark = resolveViewportTheme(background) === 'dark'
  return <div className={`w-full h-full ${isDark ? 'bg-black/50' : 'bg-slate-100/50'}`} />
}

function renderSlotContents(slot: ViewportSlot, fallback: ReactNode): ReactNode {
  if (slot.kind === 'chart') {
    return <ChartViewport slot={slot} />
  }
  return (
    <Suspense fallback={fallback}>
      <CrystalViewer />
    </Suspense>
  )
}

// ── Free layout (main viewport + dynamic pane strips) ──────────────
/** Maximum panes in the right column of the L-shaped preset; overflow continues along the bottom. */
const L_SHAPE_RIGHT_CAPACITY = 3

/** Top-right pane actions: swap into the main position or remove the pane. */
function SubViewportActions({ vpId, isDark, canRemove }: { vpId: string; isDark: boolean; canRemove: boolean }) {
  const swapWithMain = useViewportManager((s) => s.swapWithMain)
  const removeSubViewport = useViewportManager((s) => s.removeSubViewport)
  const buttonClass = cn(
    'rounded p-1',
    isDark ? 'bg-black/50 text-stone-400 hover:text-stone-100' : 'bg-white/70 text-stone-500 hover:text-stone-900',
  )
  return (
    // Leave room for ViewportCell's clear and maximize controls. CSS handles hover visibility without rerenders,
    // while focus-within keeps the actions keyboard-accessible.
    <div className="sub-viewport-controls absolute top-1.5 right-14 z-30 flex items-center gap-1">
      <button
        type="button"
        title="Swap with main viewport"
        aria-label="Swap with main viewport"
        onClick={(event) => {
          event.stopPropagation()
          swapWithMain(vpId)
        }}
        className={buttonClass}
      >
        <ArrowLeftRight className="w-3 h-3" />
      </button>
      {canRemove && (
        <button
          type="button"
          title="Remove sub-viewport"
          aria-label="Remove sub-viewport"
          onClick={(event) => {
            event.stopPropagation()
            removeSubViewport(vpId)
          }}
          className={buttonClass}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

/** One pane in a viewport strip: cell plus its action cluster. */
function SubViewportPane({
  slot,
  isDark,
  canRemove,
  fallback,
}: {
  slot: ViewportSlot
  isDark: boolean
  canRemove: boolean
  fallback: ReactNode
}) {
  return (
    // sub-viewport-pane owns visibility and sub-viewport-hotcorner expands the trigger area (see index.css).
    // The hot corner stays below the controls and deliberately covers only a narrow canvas region.
    <div className="sub-viewport-pane relative flex-1 min-h-0 min-w-0">
      <ViewportCell slot={slot} isSingle={false} revealControlsOnHover>
        {renderSlotContents(slot, fallback)}
      </ViewportCell>
      <div className="sub-viewport-hotcorner absolute top-0 right-0 z-10 h-10 w-32" aria-hidden="true" />
      <SubViewportActions vpId={slot.id} isDark={isDark} canRemove={canRemove} />
    </div>
  )
}

/**
 * Drag handle between the main viewport and pane strips. It mirrors ColumnDivider's enlarged hit area,
 * pointer capture, double-click reset, and keyboard steps, but writes the corresponding free-layout axis.
 * ColumnDivider cannot be reused directly because it is bound to the single horizontal columnSplit state.
 */
function FreeDivider({ axis }: { axis: 'right' | 'bottom' }) {
  const setFreeSplit = useViewportManager((s) => s.setFreeSplit)
  const size = useViewportManager((s) =>
    axis === 'right' ? s.freeLayout?.rightSize ?? DEFAULT_FREE_RIGHT_SIZE : s.freeLayout?.bottomSize ?? DEFAULT_FREE_BOTTOM_SIZE,
  )
  const [dragging, setDragging] = useState(false)
  const horizontal = axis === 'bottom'
  const defaultSize = axis === 'right' ? DEFAULT_FREE_RIGHT_SIZE : DEFAULT_FREE_BOTTOM_SIZE

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // Resolve ratios against the whole free-layout root; a divider's immediate parent may be only one column.
    const root = (event.currentTarget as HTMLElement).closest('[data-free-root]')
    if (!root) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    const rect = root.getBoundingClientRect()
    const move = (moveEvent: PointerEvent) => {
      if (axis === 'right') {
        if (rect.width <= 0) return
        // The right strip occupies the distance from the pointer to the root's right edge.
        setFreeSplit('right', (rect.right - moveEvent.clientX) / rect.width)
      } else {
        if (rect.height <= 0) return
        setFreeSplit('bottom', (rect.bottom - moveEvent.clientY) / rect.height)
      }
    }
    const end = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const grow = horizontal ? 'ArrowUp' : 'ArrowLeft'
    const shrink = horizontal ? 'ArrowDown' : 'ArrowRight'
    if (event.key === grow) setFreeSplit(axis, size + 0.02)
    else if (event.key === shrink) setFreeSplit(axis, size - 0.02)
    else if (event.key === 'Home' || event.key === 'Enter') setFreeSplit(axis, defaultSize)
    else return
    event.preventDefault()
  }

  return (
    <div
      // Reuse ColumnDivider's line and hover grip; the horizontal variant rotates the same visual language.
      className={cn(
        'column-divider absolute z-20 flex items-center justify-center',
        horizontal
          ? 'inset-x-0 top-0 h-6 -translate-y-1/2 cursor-row-resize [&>.column-divider-line]:h-px [&>.column-divider-line]:w-full [&>.column-divider-line]:inset-x-0 [&>.column-divider-line]:top-1/2 [&>.column-divider-line]:left-auto [&>.column-divider-line]:-translate-y-1/2 [&>.column-divider-line]:translate-x-0 [&>.column-divider-grip]:h-[3px] [&>.column-divider-grip]:w-7'
          : 'inset-y-0 left-0 w-6 -translate-x-1/2 cursor-col-resize',
      )}
      data-dragging={dragging || undefined}
      onPointerDown={beginDrag}
      onDoubleClick={() => {
        setFreeSplit(axis, defaultSize)
      }}
      onKeyDown={onKeyDown}
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={horizontal ? 'Resize bottom viewport strip' : 'Resize right viewport strip'}
      aria-valuenow={Math.round(size * 100)}
      aria-valuemin={Math.round(MIN_FREE_SPLIT * 100)}
      aria-valuemax={Math.round(MAX_FREE_SPLIT * 100)}
      tabIndex={0}
    >
      <span className="column-divider-line" aria-hidden="true" />
      <span className="column-divider-grip" aria-hidden="true" />
    </div>
  )
}

/** Add button at the end of a pane strip; hidden at the pane limit. */
function AddSubViewportButton({ isDark, orientation }: { isDark: boolean; orientation: 'column' | 'row' }) {
  const addSubViewport = useViewportManager((s) => s.addSubViewport)
  return (
    <button
      type="button"
      title="Add sub-viewport"
      aria-label="Add sub-viewport"
      onClick={() => addSubViewport()}
      className={cn(
        'flex items-center justify-center shrink-0 transition-colors',
        orientation === 'column' ? 'h-7 w-full' : 'w-7 h-full',
        isDark
          ? 'border-[0.5px] border-white/10 text-stone-500 hover:text-stone-200 hover:bg-white/5'
          : 'border-[0.5px] border-black/10 text-stone-400 hover:text-stone-700 hover:bg-black/5',
      )}
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
  )
}

/**
 * Free layout uses nested flex regions: a left column (main viewport plus bottom strip) and a right strip.
 * right uses only the right strip; bottom uses only the bottom strip; L-shape fills three right panes first.
 * Every slot keeps its store and reuses ViewportCell, so switching layouts never migrates pane content.
 */
function FreeModeView({
  free,
  viewports,
  fallback,
}: {
  free: FreeLayoutState
  viewports: Record<string, ViewportSlot>
  fallback: ReactNode
}) {
  const chromeIsDark = useThemeStore((s) => s.theme) === 'dark'
  const mainSlot = viewports[free.mainViewportId]
  const subs = free.subViewportIds
    .map((id) => viewports[id])
    .filter((slot): slot is ViewportSlot => Boolean(slot))
  if (!mainSlot) return null

  const rightSubs =
    free.placement === 'bottom' ? [] : free.placement === 'right' ? subs : subs.slice(0, L_SHAPE_RIGHT_CAPACITY)
  const bottomSubs =
    free.placement === 'bottom' ? subs : free.placement === 'right' ? [] : subs.slice(L_SHAPE_RIGHT_CAPACITY)

  const canAdd = subs.length < MAX_SUB_VIEWPORTS
  const canRemove = subs.length > 1
  // Place "+" on the edge with room; once the L-shaped right strip is full, continue along the bottom.
  const addOnRight = canAdd && free.placement !== 'bottom' && rightSubs.length < L_SHAPE_RIGHT_CAPACITY
  const addOnBottom = canAdd && !addOnRight && free.placement !== 'right'
  const showBottomStrip = bottomSubs.length > 0 || addOnBottom

  return (
    // FreeDivider resolves drag ratios against this data-free-root container.
    <div data-free-root className="flex w-full h-full overflow-hidden" style={{ borderRadius: 'inherit' }}>
      {/* Left column: main viewport plus an optional bottom strip. */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="relative flex-1 min-h-0">
          <ViewportCell slot={mainSlot} isSingle={false}>
            {renderSlotContents(mainSlot, fallback)}
          </ViewportCell>
        </div>
        {showBottomStrip && (
          <div className="relative flex shrink-0 min-h-0" style={{ height: `${free.bottomSize * 100}%` }}>
            <FreeDivider axis="bottom" />
            {bottomSubs.map((slot) => (
              <SubViewportPane key={slot.id} slot={slot} isDark={chromeIsDark} canRemove={canRemove} fallback={fallback} />
            ))}
            {addOnBottom && <AddSubViewportButton isDark={chromeIsDark} orientation="row" />}
          </div>
        )}
      </div>
      {/* Right strip. */}
      {(rightSubs.length > 0 || addOnRight) && (
        <div className="relative flex flex-col shrink-0 min-w-0" style={{ width: `${free.rightSize * 100}%` }}>
          <FreeDivider axis="right" />
          {rightSubs.map((slot) => (
            <SubViewportPane key={slot.id} slot={slot} isDark={chromeIsDark} canRemove={canRemove} fallback={fallback} />
          ))}
          {addOnRight && <AddSubViewportButton isDark={chromeIsDark} orientation="column" />}
        </div>
      )}
    </div>
  )
}

// Match corner cells to the outer panel radius.
function getCornerRadius(row: number, col: number, rows: number, cols: number): string | undefined {
  const r = 'var(--panel-radius)'
  const tl = row === 0 && col === 0 ? r : '0'
  const tr = row === 0 && col === cols - 1 ? r : '0'
  const bl = row === rows - 1 && col === 0 ? r : '0'
  const br = row === rows - 1 && col === cols - 1 ? r : '0'
  if (tl === '0' && tr === '0' && bl === '0' && br === '0') return undefined
  return `${tl} ${tr} ${br} ${bl}`
}

export function ViewportGrid() {
  const layout = useViewportManager((s) => s.layout)
  const viewports = useViewportManager((s) => s.viewports)
  const columnSplit = useViewportManager((s) => s.columnSplit)
  const maximizedViewportId = useViewportManager((s) => s.maximizedViewportId)
  const toggleMaximized = useViewportManager((s) => s.toggleMaximized)
  const freeLayout = useViewportManager((s) => s.freeLayout)
  const spec = GRID_SPECS[layout]
  const vpIds = Object.keys(viewports)
  const fallback = <ViewportFallback />

  // Escape exits maximize even when the small corner control is hard to locate over a full-screen 3D view.
  useEffect(() => {
    if (!maximizedViewportId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleMaximized(maximizedViewportId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [maximizedViewportId, toggleMaximized])

  /*
   * Maximizing affects rendering only, leaving layout, viewport slots, and stores untouched so every pane
   * returns with its original content. This avoids the content loss caused by using a temporary 1x1 layout.
   */
  const maximizedSlot = maximizedViewportId ? viewports[maximizedViewportId] : undefined
  if (maximizedSlot) {
    return (
      <div className="relative w-full h-full">
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
          <LayoutSwitcher />
        </div>
        <ViewportCell slot={maximizedSlot} isSingle={false} cornerRadius="var(--panel-radius)">
          {renderSlotContents(maximizedSlot, fallback)}
        </ViewportCell>
      </div>
    )
  }

  // Free layout: main viewport plus dynamic pane strips. Maximize still takes precedence above.
  if (freeLayout) {
    return (
      <div className="relative w-full h-full">
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
          <LayoutSwitcher />
        </div>
        <FreeModeView free={freeLayout} viewports={viewports} fallback={fallback} />
      </div>
    )
  }

  /*
   * A single columnSplit is unambiguous only in two-column layouts. Wider grids have multiple boundaries,
   * so they omit the divider until independent split positions are a real requirement.
   */
  const resizable = spec.cols === 2
  const columnTemplate = resizable
    ? `${columnSplit}fr ${1 - columnSplit}fr`
    : `repeat(${spec.cols}, 1fr)`

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
        <LayoutSwitcher />
      </div>

      {layout === '1x1' ? (() => {
        const slot = viewports[vpIds[0]]
        if (!slot) return null
        return (
          <ViewportCell slot={slot} isSingle={true}>
            {renderSlotContents(slot, fallback)}
          </ViewportCell>
        )
      })() : (
        <div
          className="relative w-full h-full overflow-hidden"
          style={{
            display: 'grid',
            gridTemplateColumns: columnTemplate,
            gridTemplateRows: `repeat(${spec.rows}, 1fr)`,
            borderRadius: 'inherit',
          }}
        >
          {/* Position over the column boundary without consuming a grid track; see ColumnDivider. */}
          {resizable && <ColumnDivider />}
          {vpIds.map((vpId, idx) => {
            const slot = viewports[vpId]
            if (!slot) return null
            const row = Math.floor(idx / spec.cols)
            const col = idx % spec.cols
            const cornerRadius = getCornerRadius(row, col, spec.rows, spec.cols)
            return (
              <ViewportCell key={vpId} slot={slot} isSingle={false} cornerRadius={cornerRadius}>
                {renderSlotContents(slot, fallback)}
              </ViewportCell>
            )
          })}
        </div>
      )}
    </div>
  )
}
