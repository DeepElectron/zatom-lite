/** Draggable shell for BatchPanel; the title bar is its drag handle. */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { ChevronDown, ChevronUp, Lock, Unlock, X, Move } from 'lucide-react'
import { BatchPanel } from './batch-panel'

interface FloatingBatchPanelProps {
  constraintsRef: RefObject<HTMLDivElement | null>
  onDock: () => void
}

export function FloatingBatchPanel({ constraintsRef, onDock }: FloatingBatchPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [isPositionLocked, setIsPositionLocked] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState(() => ({
    x: typeof window === 'undefined' ? 360 : Math.max(12, Math.round((window.innerWidth - 340) / 2)),
    y: 80,
  }))

  const clampPosition = useCallback((next: { x: number; y: number }) => {
    const bounds = constraintsRef.current?.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    if (!bounds || !panel) return next
    const margin = 12
    return {
      x: Math.min(Math.max(margin, next.x), Math.max(margin, bounds.width - panel.width - margin)),
      y: Math.min(Math.max(margin, next.y), Math.max(margin, bounds.height - panel.height - margin)),
    }
  }, [constraintsRef])

  useEffect(() => {
    const panel = panelRef.current
    const bounds = constraintsRef.current
    if (!panel || !bounds) return
    const keepInsideViewport = () => setPosition((current) => clampPosition(current))
    const observer = new ResizeObserver(keepInsideViewport)
    observer.observe(panel)
    observer.observe(bounds)
    window.addEventListener('resize', keepInsideViewport)
    keepInsideViewport()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', keepInsideViewport)
    }
  }, [clampPosition, constraintsRef])

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (isPositionLocked || !panelRef.current) return
    const panel = panelRef.current.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - panel.left,
      offsetY: event.clientY - panel.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  const updateDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const bounds = constraintsRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return
    setPosition(clampPosition({
      x: event.clientX - bounds.left - drag.offsetX,
      y: event.clientY - bounds.top - drag.offsetY,
    }))
  }

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDragging(false)
  }

  return (
    <div
      ref={panelRef}
      className="fixed left-0 top-0 z-50 flex max-h-[75vh] w-[340px] flex-col overflow-hidden rounded-lg border shadow-2xl"
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        willChange: isPositionLocked ? 'auto' : 'transform',
        background: 'var(--panel-bg)',
        borderColor: 'var(--panel-border)',
        color: 'var(--panel-text)',
      }}
    >
      <div
        className={`flex select-none items-center justify-between px-3 py-2 ${isPositionLocked ? 'cursor-default' : isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          touchAction: 'none',
          background: 'var(--panel-elevated)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--panel-border)',
        }}
        onPointerDown={startDrag}
        onPointerMove={updateDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div className="flex items-center gap-1.5">
          <Move className="h-3.5 w-3.5" style={{ color: isPositionLocked ? 'var(--panel-text-tertiary)' : 'var(--panel-text-secondary)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--panel-text)' }}>Assets</span>
          <span className="ml-1 text-[9px]" style={{ color: 'var(--panel-text-tertiary)' }}>
            {isPositionLocked ? 'locked' : 'drag handle'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setIsCollapsed((value) => !value)}
            className="zatom-pressable rounded p-1 text-[var(--panel-text-secondary)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"
            title={isCollapsed ? 'Expand Assets' : 'Collapse Assets'}
            aria-label={isCollapsed ? 'Expand Assets' : 'Collapse Assets'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setIsPositionLocked((value) => !value)}
            className="zatom-pressable rounded p-1 text-[var(--panel-text-secondary)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"
            title={isPositionLocked ? 'Unlock window position' : 'Lock window position'}
          >
            {isPositionLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
          <button
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onDock}
            className="zatom-pressable rounded p-1 text-[var(--panel-text-secondary)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"
            title="Dock back"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto p-3">
          <BatchPanel />
        </div>
      )}
    </div>
  )
}
