import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import zatomMarkUrl from '../../assets/zatom-mark-180.png'

interface ZatomBrandButtonProps {
  className?: string
  showCoachmark?: boolean
  onCoachmarkDismiss?: () => void
  onOpenAbout: () => void
}

interface HintPosition {
  left: number
  top: number
}

/** The persistent, accessible route back to copyright and license information. */
export function ZatomBrandButton({
  className = '',
  showCoachmark = false,
  onCoachmarkDismiss,
  onOpenAbout,
}: ZatomBrandButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const openTimer = useRef<number | null>(null)
  const tooltipId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [position, setPosition] = useState<HintPosition | null>(null)
  const tooltipOpen = showCoachmark || hovered || focused

  const clearOpenTimer = () => {
    if (openTimer.current === null) return
    window.clearTimeout(openTimer.current)
    openTimer.current = null
  }

  const updatePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({
      left: Math.max(12, Math.min(rect.right + 12, window.innerWidth - 286)),
      top: Math.max(12, Math.min(rect.top - 2, window.innerHeight - 150)),
    })
  }

  useEffect(() => {
    if (!tooltipOpen) {
      setPosition(null)
      return
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [tooltipOpen])

  useEffect(() => {
    if (!showCoachmark) return
    const timeout = window.setTimeout(() => onCoachmarkDismiss?.(), 6_000)
    return () => window.clearTimeout(timeout)
  }, [onCoachmarkDismiss, showCoachmark])

  useEffect(() => () => clearOpenTimer(), [])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="About Zatom, copyright, and licenses"
        aria-describedby={tooltipOpen && position ? tooltipId : undefined}
        data-brand-coachmark={showCoachmark || undefined}
        className={`zatom-brand-button zatom-pressable inline-flex shrink-0 items-center justify-center rounded-lg ${className}`}
        onPointerEnter={() => {
          clearOpenTimer()
          openTimer.current = window.setTimeout(() => {
            openTimer.current = null
            setHovered(true)
          }, 420)
        }}
        onPointerLeave={() => {
          clearOpenTimer()
          setHovered(false)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => {
          clearOpenTimer()
          setHovered(false)
          onCoachmarkDismiss?.()
          onOpenAbout()
        }}
      >
        <img
          src={zatomMarkUrl}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-contain"
        />
      </button>

      {tooltipOpen && position && typeof document !== 'undefined'
        ? createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="zatom-brand-hint fixed z-[80] w-[274px] rounded-xl border px-3.5 py-3 text-left shadow-xl"
            data-coachmark={showCoachmark || undefined}
            style={{
              left: position.left,
              top: position.top,
              color: 'var(--panel-text)',
              background: 'var(--panel-elevated)',
              borderColor: 'var(--panel-border)',
              transformOrigin: 'left top',
            }}
          >
            <span
              aria-hidden
              className="absolute top-3 -left-[7px] h-3 w-3 rotate-45 border-b border-l"
              style={{ background: 'var(--panel-elevated)', borderColor: 'var(--panel-border)' }}
            />
            <span className="block text-xs font-semibold tracking-[-0.015em]">Zatom</span>
            <span className="mt-1 block text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
              Copyright © 2026 zauq tech
            </span>
            <span className="block text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
              Code: AGPL-3.0-or-later · Brand assets reserved
            </span>
            <span className="mt-2 block text-[10px] font-medium" style={{ color: 'var(--panel-accent)' }}>
              {showCoachmark ? 'You can revisit these terms here.' : 'Click for About & Licenses'}
            </span>
          </div>,
          document.body,
        )
        : null}
    </>
  )
}
