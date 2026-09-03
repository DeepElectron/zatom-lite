/**
 * Attaches window-level mousemove and mouseup handlers while `active` is true.
 * This keeps drag tracking alive after the pointer leaves the source element.
 *
 *   const [dragging, setDragging] = useState(false)
 *   useWindowMouseTracking(dragging, handleMove, handleEnd)
 *
 * Handlers are stored in refs so they stay current without reinstalling the
 * listeners, and cleanup follows the `active` transition automatically.
 */

import { useEffect } from 'react'

export function useWindowMouseTracking(
  active: boolean,
  onMove: (e: MouseEvent) => void,
  onEnd: () => void,
) {
  useEffect(() => {
    if (!active) return
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onEnd)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onEnd)
    }
  }, [active, onMove, onEnd])
}
