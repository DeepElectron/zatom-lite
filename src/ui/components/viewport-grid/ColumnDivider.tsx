/** Wide-hit-area column divider whose visual grip appears only during interaction. */
import { useRef, useState } from 'react'
import {
  useViewportManager,
  DEFAULT_COLUMN_SPLIT,
  MIN_COLUMN_SPLIT,
  MAX_COLUMN_SPLIT,
} from '../../../orchestration/viewportManager'

const KEY_STEP = 0.02

export function ColumnDivider() {
  const columnSplit = useViewportManager((s) => s.columnSplit)
  const setColumnSplit = useViewportManager((s) => s.setColumnSplit)
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const track = trackRef.current?.parentElement
    if (!track) return

    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)

    const rect = track.getBoundingClientRect()
    const move = (moveEvent: PointerEvent) => {
      if (rect.width <= 0) return
      setColumnSplit((moveEvent.clientX - rect.left) / rect.width)
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
    if (event.key === 'ArrowLeft') {
      setColumnSplit(columnSplit - KEY_STEP)
    } else if (event.key === 'ArrowRight') {
      setColumnSplit(columnSplit + KEY_STEP)
    } else if (event.key === 'Home' || event.key === 'Enter') {
      setColumnSplit(DEFAULT_COLUMN_SPLIT)
    } else {
      return
    }
    event.preventDefault()
  }

  return (
    <div
      ref={trackRef}
      className="column-divider absolute inset-y-0 z-20 flex w-6 -translate-x-1/2 cursor-col-resize items-center justify-center"
      style={{ left: `${columnSplit * 100}%` }}
      data-dragging={dragging || undefined}
      onPointerDown={beginDrag}
      onDoubleClick={() => {
        setColumnSplit(DEFAULT_COLUMN_SPLIT)
      }}
      onKeyDown={onKeyDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize columns"
      aria-valuenow={Math.round(columnSplit * 100)}
      aria-valuemin={Math.round(MIN_COLUMN_SPLIT * 100)}
      aria-valuemax={Math.round(MAX_COLUMN_SPLIT * 100)}
      tabIndex={0}
    >
      {/* The resting divider aligns with the grid's existing one-pixel border. */}
      <span className="column-divider-line" aria-hidden="true" />
      {/* The grip appears only on hover or drag and thickens the line without changing layout. */}
      <span className="column-divider-grip" aria-hidden="true" />
    </div>
  )
}
