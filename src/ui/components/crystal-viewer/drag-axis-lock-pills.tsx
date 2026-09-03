'use client'

/** Keyboard-accessible axis-lock controls shared by atom and selection drags. */
import { useEffect } from 'react'
import { useActiveCrystalStore, getActiveViewportStoreApi } from '../../../orchestration/ViewportContext'

const AXIS_COLOR: Record<'a' | 'b' | 'c', string> = { a: '#FF453A', b: '#30D158', c: '#0A84FF' }
const KEY_TO_AXIS: Record<string, 'a' | 'b' | 'c'> = { x: 'a', y: 'b', z: 'c' }
const AXIS_KEY_HINT: Record<'a' | 'b' | 'c', string> = { a: 'X', b: 'Y', c: 'Z' }

export function DragAxisLockPills() {
  const toolMode = useActiveCrystalStore((s) => s.toolMode)
  const dragAxisLock = useActiveCrystalStore((s) => s.dragAxisLock)
  const setDragAxisLock = useActiveCrystalStore((s) => s.setDragAxisLock)
  const hasAtoms = useActiveCrystalStore((s) => s.atoms.length > 0)

  const active = toolMode === 'drag-atom' && hasAtoms

  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const key = e.key.toLowerCase()
      const axis = KEY_TO_AXIS[key]
      if (axis) {
        e.preventDefault()
        setDragAxisLock(axis)
      } else if (key === 'v') {
        e.preventDefault()
        setDragAxisLock('auto')
      } else if (e.key === 'Escape') {
        const api = getActiveViewportStoreApi()
        if (api?.getState().dragAxisLock) setDragAxisLock(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, setDragAxisLock])

  if (!active) return null

  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-1.5 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)] backdrop-blur-xl"
      role="radiogroup"
      aria-label="Constrain move direction to a lattice axis"
    >
      <span className="px-1.5 text-[10.5px] font-medium text-[var(--panel-text-tertiary)]">
        {dragAxisLock === 'auto' ? 'Snap' : dragAxisLock ? 'Locked' : 'Free'}
      </span>
      <button
        type="button"
        role="radio"
        aria-checked={dragAxisLock === 'auto'}
        title="On by default: each drag snaps to the dominant lattice axis. Click or press V to drag freely (V)"
        className="zatom-pressable inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold transition-colors duration-100"
        style={
          dragAxisLock === 'auto'
            ? { background: 'var(--panel-accent)', color: '#fff', boxShadow: '0 0 10px rgba(120,120,255,0.4)' }
            : { color: 'var(--panel-accent)' }
        }
        onClick={() => {
          setDragAxisLock('auto')
        }}
      >
        auto
        <kbd
          className="rounded-[3px] px-0.5 text-[8.5px] font-normal leading-[13px]"
          style={{
            background: dragAxisLock === 'auto' ? 'rgba(255,255,255,0.25)' : 'var(--panel-hover)',
            color: dragAxisLock === 'auto' ? '#fff' : 'var(--panel-text-secondary)',
          }}
        >
          V
        </kbd>
      </button>
      {(['a', 'b', 'c'] as const).map((axis) => {
        const locked = dragAxisLock === axis
        return (
          <button
            key={axis}
            type="button"
            role="radio"
            aria-checked={locked}
            title={`Constrain movement along ${axis} axis (${AXIS_KEY_HINT[axis]})`}
            className="zatom-pressable inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold transition-colors duration-100"
            style={
              locked
                ? { background: AXIS_COLOR[axis], color: '#fff', boxShadow: `0 0 10px ${AXIS_COLOR[axis]}66` }
                : { color: AXIS_COLOR[axis] }
            }
            onClick={() => {
              setDragAxisLock(axis)
            }}
          >
            {axis}
            <kbd
              className="rounded-[3px] px-0.5 text-[8.5px] font-normal leading-[13px]"
              style={{
                background: locked ? 'rgba(255,255,255,0.25)' : 'var(--panel-hover)',
                color: locked ? '#fff' : 'var(--panel-text-secondary)',
              }}
            >
              {AXIS_KEY_HINT[axis]}
            </kbd>
          </button>
        )
      })}
    </div>
  )
}
