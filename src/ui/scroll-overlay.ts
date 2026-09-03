/**
 * Shared overlay scrollbars avoid the layout shift caused by classic native
 * scrollbars. Fixed thumbs sit above each active container, fade after scrolling,
 * and do not change containing blocks for existing absolutely positioned content.
 */

const IDLE_HIDE_MS = 900
const MIN_THUMB_PX = 28
/** Inset from the container edge; paired with --scroll-overlay-size. */
const EDGE_INSET_PX = 2

type Axis = 'y' | 'x'

export interface ThumbGeometry {
  /** Thumb length in CSS pixels. */
  size: number
  /** Offset from the beginning of the track in CSS pixels. */
  offset: number
}

/**
 * Compute thumb geometry as a pure function. Return null when the container is
 * not meaningfully scrollable, including subpixel layout noise.
 */
export function computeThumbGeometry(
  scrollSize: number,
  clientSize: number,
  scrollPos: number,
  trackSize: number,
): ThumbGeometry | null {
  const maxScroll = scrollSize - clientSize
  // Ignore a one-pixel discrepancy caused by subpixel layout rounding.
  if (maxScroll <= 1) return null
  const size = Math.max(MIN_THUMB_PX, (clientSize / scrollSize) * trackSize)
  const progress = Math.min(1, Math.max(0, scrollPos / maxScroll))
  return { size, offset: progress * (trackSize - size) }
}

function createThumb(axis: Axis): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'scroll-overlay-thumb'
  el.dataset.axis = axis
  el.setAttribute('aria-hidden', 'true')
  return el
}

export function installScrollOverlay(): () => void {
  if (typeof document === 'undefined') return () => {}

  const thumbs: Record<Axis, HTMLDivElement> = { y: createThumb('y'), x: createThumb('x') }
  document.body.append(thumbs.y, thumbs.x)

  const hideTimers: Record<Axis, number | null> = { y: null, x: null }
  let frame: number | null = null
  let pending: Element | null = null

  const hide = (axis: Axis) => {
    thumbs[axis].dataset.visible = 'false'
  }

  const scheduleHide = (axis: Axis) => {
    if (hideTimers[axis] !== null) window.clearTimeout(hideTimers[axis]!)
    hideTimers[axis] = window.setTimeout(() => {
      hideTimers[axis] = null
      hide(axis)
    }, IDLE_HIDE_MS)
  }

  /** Position a thumb on one container edge and report whether that axis scrolls. */
  const place = (target: Element, axis: Axis): boolean => {
    const isY = axis === 'y'

    // The root scroll viewport is the window, not the document's full rectangle.
    const isRoot = target === document.scrollingElement || target === document.body
    const rect = isRoot
      ? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }
      : target.getBoundingClientRect()

    const geometry = computeThumbGeometry(
      isY ? target.scrollHeight : target.scrollWidth,
      isY ? target.clientHeight : target.clientWidth,
      isY ? target.scrollTop : target.scrollLeft,
      isY ? rect.height : rect.width,
    )
    if (!geometry) return false

    const thumb = thumbs[axis]
    if (isY) {
      thumb.style.height = `${geometry.size}px`
      thumb.style.transform = `translate3d(${rect.left + rect.width - EDGE_INSET_PX}px, ${rect.top + geometry.offset}px, 0) translateX(-100%)`
    } else {
      thumb.style.width = `${geometry.size}px`
      thumb.style.transform = `translate3d(${rect.left + geometry.offset}px, ${rect.top + rect.height - EDGE_INSET_PX}px, 0) translateY(-100%)`
    }
    thumb.dataset.visible = 'true'
    scheduleHide(axis)
    return true
  }

  const flush = () => {
    frame = null
    const target = pending
    pending = null
    if (!target) return
    // Only the active axis is refreshed; the other thumb can fade naturally.
    if (!place(target, 'y')) hide('y')
    if (!place(target, 'x')) hide('x')
  }

  const onScroll = (event: Event) => {
    const target = event.target
    // Document scroll events use the scrolling root as their effective target.
    pending = target instanceof Element
      ? target
      : (document.scrollingElement ?? document.documentElement)
    if (frame === null) frame = requestAnimationFrame(flush)
  }

  // Scroll does not bubble, so capture is required for descendant containers.
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true })
    if (frame !== null) cancelAnimationFrame(frame)
    for (const axis of ['y', 'x'] as Axis[]) {
      if (hideTimers[axis] !== null) window.clearTimeout(hideTimers[axis]!)
      thumbs[axis].remove()
    }
  }
}
