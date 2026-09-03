import { useState } from 'react'
import {
  useViewportManager,
  GRID_SPECS,
  type FreePlacement,
  type GridLayout,
} from '../../../orchestration/viewportManager'
import { LayoutGrid } from 'lucide-react'

const LAYOUTS: GridLayout[] = ['1x1', '1x2', '2x2', '2x3', '2x4', '3x4', '4x4']

const FREE_PLACEMENTS: readonly { id: FreePlacement; label: string; title: string }[] = [
  { id: 'right', label: 'Right', title: 'Free layout: main viewport + right viewport strip' },
  { id: 'bottom', label: 'Bottom', title: 'Free layout: main viewport + bottom viewport strip' },
  { id: 'l-shape', label: 'L-shape', title: 'Free layout: main viewport + L-shaped viewport strip' },
]

/** Free-layout preset icon: one main viewport plus smaller panes along the selected edges. */
function FreeIcon({ placement, active }: { placement: FreePlacement; active: boolean }) {
  const size = 20
  const gap = 1.5
  const opacity = active ? 1 : 0.4
  // Arrange the main rectangle and pane tiles to mirror the real FreeModeView layout.
  const strip = size * 0.32
  const mainW = placement === 'bottom' ? size : size - strip - gap
  const mainH = placement === 'right' ? size : size - strip - gap
  const subs: { x: number; y: number; w: number; h: number }[] = []
  if (placement !== 'bottom') {
    const count = 2
    const h = (mainH - gap * (count - 1)) / count
    for (let i = 0; i < count; i++) subs.push({ x: mainW + gap, y: i * (h + gap), w: strip, h })
  }
  if (placement !== 'right') {
    const count = 2
    const w = (mainW - gap * (count - 1)) / count
    for (let i = 0; i < count; i++) subs.push({ x: i * (w + gap), y: mainH + gap, w, h: strip })
  }
  if (placement === 'l-shape') {
    subs.push({ x: mainW + gap, y: mainH + gap, w: strip, h: strip })
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect x={0} y={0} width={mainW} height={mainH} rx={1} fill="currentColor" opacity={opacity} />
      {subs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={1} fill="currentColor" opacity={opacity * 0.7} />
      ))}
    </svg>
  )
}

function GridIcon({ cols, rows, active }: { cols: number; rows: number; active: boolean }) {
  const size = 20
  const gap = 1.5
  const cellW = (size - gap * (cols - 1)) / cols
  const cellH = (size - gap * (rows - 1)) / rows

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => (
          <rect
            key={`${r}-${c}`}
            x={c * (cellW + gap)}
            y={r * (cellH + gap)}
            width={cellW}
            height={cellH}
            rx={1}
            fill="currentColor"
            opacity={active ? 1 : 0.4}
          />
        ))
      )}
    </svg>
  )
}

export function LayoutSwitcher() {
  const [open, setOpen] = useState(false)
  const layout = useViewportManager((s) => s.layout)
  const setLayout = useViewportManager((s) => s.setLayout)
  const freeLayout = useViewportManager((s) => s.freeLayout)
  const enterFreeMode = useViewportManager((s) => s.enterFreeMode)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="modeler-chrome-surface zatom-pressable flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--panel-hover)]"
        style={{
          background: 'var(--panel-bg)',
          borderColor: 'var(--panel-border)',
          color: 'var(--panel-text-secondary)',
          boxShadow: 'var(--shadow-float)',
        }}
        title="Split screen layout"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span>{freeLayout ? 'Free' : layout === '1x1' ? 'Single' : layout}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-2 py-1.5 shadow-xl">
            <div className="flex items-center gap-1">
              {LAYOUTS.map((id) => {
                const spec = GRID_SPECS[id]
                const active = !freeLayout && layout === id
                return (
                  <button
                    key={id}
                    onClick={() => { setLayout(id); setOpen(false) }}
                    aria-pressed={active}
                    data-selected={active}
                    className="zatom-choice zatom-pressable flex flex-col items-center gap-0.5 rounded-lg border-transparent px-2 py-1.5"
                    title={id}
                  >
                    <GridIcon cols={spec.cols} rows={spec.rows} active={active} />
                    <span className="text-[9px] font-medium whitespace-nowrap">{id === '1x1' ? '1' : id}</span>
                  </button>
                )
              })}
              {/* Free-layout presets: a main viewport plus dynamic pane strips. Selecting a grid exits free layout. */}
              <div className="mx-1 h-8 w-px shrink-0 bg-[var(--panel-border)]" />
              {FREE_PLACEMENTS.map(({ id, label, title }) => {
                const active = freeLayout?.placement === id
                return (
                  <button
                    key={id}
                    onClick={() => { enterFreeMode(id); setOpen(false) }}
                    aria-pressed={active}
                    data-selected={active}
                    className="zatom-choice zatom-pressable flex flex-col items-center gap-0.5 rounded-lg border-transparent px-2 py-1.5"
                    title={title}
                  >
                    <FreeIcon placement={id} active={active} />
                    <span className="text-[9px] font-medium whitespace-nowrap">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
