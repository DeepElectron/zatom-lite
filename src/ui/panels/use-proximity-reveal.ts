import { useEffect, useRef } from 'react'

/** Horizontal reveal band kept close to the roughly 52px collapsed rail. */
const REVEAL_DISTANCE = 64

/** Asymmetric interpolation: a slow fade-out and a responsive 250ms fade-in. */
const FADE_OUT_RATE = 0.055
const FADE_IN_RATE = 0.18

/** Snap tiny residuals to zero so requestAnimationFrame can stop. */
const SETTLE_EPSILON = 0.004

/**
 * Fades a collapsed rail according to pointer distance. Opacity is written
 * directly in rAF to avoid React renders and to support different in/out rates.
 * @param side Which inner rail edge to measure.
 * @param active Whether the rail is collapsed.
 */
export function useProximityReveal<T extends HTMLElement>(side: 'left' | 'right', active: boolean) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Expanded rails remain fully opaque and install no listeners.
    if (!active) {
      element.style.opacity = ''
      return
    }

    // Respect reduced-motion preference.
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.style.opacity = ''
      return
    }

    /** Wait for a real mouse or pen event before fading so touch-only devices stay visible. */
    let pointerSeen = false
    // Keyboard focus keeps the rail fully visible without pointer proximity.
    let hasFocus = false

    let current = 1
    let target = 1
    let frame = 0

    const step = () => {
      frame = 0
      const diff = target - current
      if (Math.abs(diff) < SETTLE_EPSILON) {
        current = target
        element.style.opacity = current === 1 ? '' : String(current)
        return
      }
      current += diff * (diff > 0 ? FADE_IN_RATE : FADE_OUT_RATE)
      element.style.opacity = String(current)
      frame = requestAnimationFrame(step)
    }

    const setTarget = (value: number) => {
      target = value
      if (!frame) frame = requestAnimationFrame(step)
    }

    const measure = (clientX: number) => {
      const rect = element.getBoundingClientRect()
      // Full-height rails need only horizontal distance.
      const edge = side === 'left' ? rect.right : rect.left
      const distance = side === 'left' ? clientX - edge : edge - clientX
      if (distance <= 0) return 1 // Pointer is on the panel or beyond its inner edge.
      if (distance >= REVEAL_DISTANCE) return 0
      return 1 - distance / REVEAL_DISTANCE
    }

    const onPointerMove = (event: PointerEvent) => {
      // Ignore touch because it has no persistent hover position after release.
      if (event.pointerType === 'touch') return
      pointerSeen = true
      if (hasFocus) return
      setTarget(measure(event.clientX))
    }

    // Fade out when the pointer leaves the window instead of freezing mid-fade.
    const onPointerLeaveWindow = () => {
      if (hasFocus || !pointerSeen) return
      setTarget(0)
    }

    const onFocusIn = () => {
      hasFocus = true
      setTarget(1)
    }

    const onFocusOut = (event: FocusEvent) => {
      if (element.contains(event.relatedTarget as Node | null)) return
      hasFocus = false
      setTarget(pointerSeen ? 0 : 1)
    }

    // Start visible until a hover-capable pointer is actually observed.
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerleave', onPointerLeaveWindow)
    element.addEventListener('focusin', onFocusIn)
    element.addEventListener('focusout', onFocusOut)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerleave', onPointerLeaveWindow)
      element.removeEventListener('focusin', onFocusIn)
      element.removeEventListener('focusout', onFocusOut)
      element.style.opacity = ''
    }
  }, [side, active])

  return ref
}
