import { useRef, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Maximize2, Minimize2, Trash2 } from 'lucide-react'
import { wasDoubleClickConsumedBy3D } from './double-click-arbiter'
import { clearViewportWorkspace } from '../../../agent/viewer-context'
import type { ViewportSlot } from '../../../orchestration/viewportManager'
import { useViewportManager } from '../../../orchestration/viewportManager'
import { ViewportStoreProvider } from '../../../orchestration/ViewportContext'
import { cn } from '../../../ui-kit/utils'
import { resolveViewportTheme, useThemeStore } from '../../../host'
import { ConfirmDeleteDialog } from '../../panels/confirm-delete-dialog'

interface ViewportCellProps {
  slot: ViewportSlot
  isSingle: boolean
  children: ReactNode
  cornerRadius?: string
  /**
   * Reveal corner controls on hover (an ancestor must have sub-viewport-pane; see index.css).
   * Free-layout panes are small enough that persistent controls dominate their content; grid cells remain persistent.
   */
  revealControlsOnHover?: boolean
}

function crystalSlotBackground(slot: ViewportSlot): string | null {
  if (slot.kind !== 'crystal') return null
  const state = slot.storeInstance.getState() as unknown as {
    background: string
    presentationStylePreview?: { background: string } | null
  }
  return state.presentationStylePreview?.background ?? state.background
}

function crystalSlotHasWorkspace(slot: ViewportSlot): boolean {
  if (slot.kind !== 'crystal') return false
  const state = slot.storeInstance.getState() as unknown as {
    atoms: readonly unknown[]
    trajectoryFrames: readonly unknown[] | null
    compactStructure: unknown | null
    bioStructure: unknown | null
    molecularOrbital: { cubData: unknown | null; moldenData: unknown | null; colorField: unknown | null }
    constructedPlane: unknown | null
  }
  return state.atoms.length > 0
    || state.trajectoryFrames !== null
    || state.compactStructure !== null
    || state.bioStructure !== null
    || state.molecularOrbital.cubData !== null
    || state.molecularOrbital.moldenData !== null
    || state.molecularOrbital.colorField !== null
    || state.constructedPlane !== null
}

function isViewportControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-viewport-control]') !== null
}

export function ViewportCell({ slot, isSingle, children, cornerRadius, revealControlsOnHover }: ViewportCellProps) {
  const isActive = useViewportManager((s) => s.activeViewportId === slot.id)
  const setActive = useViewportManager((s) => s.setActive)
  const chromeIsDark = useThemeStore(s => s.theme) === 'dark'
  const isChart = slot.kind === 'chart'
  const viewportBackground = useSyncExternalStore(
    slot.kind === 'crystal' ? slot.storeInstance.subscribe : () => () => {},
    () => crystalSlotBackground(slot),
    () => crystalSlotBackground(slot),
  )
  const hasWorkspace = useSyncExternalStore(
    slot.kind === 'crystal' ? slot.storeInstance.subscribe : () => () => {},
    () => crystalSlotHasWorkspace(slot),
    () => crystalSlotHasWorkspace(slot),
  )
  const isDark = viewportBackground
    ? resolveViewportTheme(viewportBackground) === 'dark'
    : chromeIsDark
  const structureName = slot.kind === 'crystal' ? slot.structureName : null
  const blockActivationClick = useRef(false)
  const isMaximized = useViewportManager((s) => s.maximizedViewportId === slot.id)
  const toggleMaximized = useViewportManager((s) => s.toggleMaximized)
  const activationOnly = !isSingle && !isChart && !isActive

  /*
   * Double-click toggles maximize only on unused canvas space. A molecule double-click belongs to 3D selection,
   * so the consumer records it and this DOM handler yields. R3F stopPropagation cannot stop the native dblclick;
   * see double-click-arbiter for the ownership handshake.
   */
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isSingle || isViewportControlTarget(event.target) || wasDoubleClickConsumedBy3D()) return
    event.stopPropagation()
    toggleMaximized(slot.id)
  }

  // Chart slots don't expose modeler edits — chart content reads its source
  // store directly. We still wrap in a ViewportStoreProvider when the slot has
  // a real store so all crystal children see a valid context.
  const content = slot.kind === 'crystal' ? (
    <ViewportStoreProvider value={slot.storeInstance as any}>
      {children}
    </ViewportStoreProvider>
  ) : (
    children
  )

  return (
    <div
      data-viewport-id={slot.id}
      className={cn(
        'relative w-full h-full overflow-hidden',
        !isSingle && !isChart && 'cursor-pointer',
        !isSingle && (isDark ? 'border-[0.5px] border-white/10' : 'border-[0.5px] border-black/10'),
      )}
      style={cornerRadius ? { borderRadius: cornerRadius } : undefined}
      onDoubleClick={handleDoubleClick}
      onPointerDownCapture={(event) => {
        if (isViewportControlTarget(event.target)) {
          blockActivationClick.current = false
          return
        }
        if (!activationOnly) return
        blockActivationClick.current = true
        event.stopPropagation()
        setActive(slot.id)
      }}
      onPointerCancelCapture={() => { blockActivationClick.current = false }}
      onClickCapture={(event) => {
        if (isViewportControlTarget(event.target)) {
          blockActivationClick.current = false
          return
        }
        if (!blockActivationClick.current && !activationOnly) return
        blockActivationClick.current = false
        event.stopPropagation()
        if (!isActive) setActive(slot.id)
      }}
    >
      {content}

      {/* Active outline inherits the cell radius; chart panes do not participate in activation. */}
      {!isSingle && !isChart && isActive && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ borderRadius: cornerRadius, boxShadow: 'inset 0 0 0 1px var(--control-selected-border)' }}
        />
      )}

      {/* Dim inactive panes only on dark backgrounds. */}
      {!isSingle && !isChart && !isActive && isDark && (
        <div className="absolute inset-0 pointer-events-none bg-black/15" />
      )}

      {/* Keep an explicit maximize control because double-click remains available to atom selection. */}
      {!isSingle && (
        <button
          type="button"
          title={isMaximized ? 'Restore viewport (Esc)' : 'Maximize viewport (double-click canvas)'}
          aria-label={isMaximized ? 'Restore viewport' : 'Maximize viewport'}
          data-viewport-control
          onClick={(event) => {
            event.stopPropagation()
            toggleMaximized(slot.id)
          }}
          className={cn(
            'absolute top-1.5 right-2 z-20 rounded p-1',
            isDark
              ? 'bg-black/50 text-stone-400 hover:text-stone-100'
              : 'bg-white/70 text-stone-500 hover:text-stone-900',
            // index.css reveals controls from the .sub-viewport-pane host and preserves keyboard focus visibility.
            revealControlsOnHover && 'sub-viewport-controls',
          )}
        >
          {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>
      )}

      {!isSingle && !isChart && hasWorkspace && (
        <ConfirmDeleteDialog
          title={`Clear ${slot.label}?`}
          description={structureName
            ? `This removes “${structureName}” and its attached trajectory and visualizations. The pane and split layout stay in place.`
            : 'This removes the structure and attached trajectory and visualizations. The pane and split layout stay in place.'}
          confirmLabel="Clear Viewport"
          onConfirm={() => {
            clearViewportWorkspace(
              slot.storeInstance as unknown as Parameters<typeof clearViewportWorkspace>[0],
              slot.id,
            )
          }}
        >
          <button
            type="button"
            title="Clear viewport"
            aria-label={`Clear ${slot.label}`}
            data-viewport-control
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'absolute top-1.5 right-8 z-20 rounded p-1',
              isDark
                ? 'bg-black/50 text-stone-400 hover:text-red-300'
                : 'bg-white/70 text-stone-500 hover:text-red-600',
              revealControlsOnHover && 'sub-viewport-controls',
            )}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </ConfirmDeleteDialog>
      )}

      {/* Pane badge. */}
      {!isSingle && !isChart && (
        <div className={cn(
          'absolute top-1.5 z-10 px-1.5 py-0.5 rounded text-[10px] font-medium pointer-events-none',
          'left-2',
          isActive
            ? 'text-[var(--control-primary-text)]'
            : isDark
              ? 'bg-black/50 text-stone-400'
              : 'bg-white/70 text-stone-500',
        )} style={isActive ? { background: 'var(--control-primary-bg)' } : undefined}>
          {slot.label}
          {structureName && (
            <span className="ml-1 opacity-70">· {structureName}</span>
          )}
        </div>
      )}
    </div>
  )
}
