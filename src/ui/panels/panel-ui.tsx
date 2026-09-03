"use client"

import type React from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { ChevronDown, Minus, Plus, type LucideIcon } from "lucide-react"
import { cn } from "../../ui-kit/utils"

/* Shared panel UI primitives. Presentation only — owners wire real state and
   handlers. Slider motion lives in index.css. */

/* Section label (uppercase) */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--panel-text-secondary)]">
      {children}
    </span>
  )
}

/* Inline status message (warning / error / success / info).
   All colors come from the --status-* tokens, which are defined for the light,
   dark, and viewport-derived themes alike. Never hardcode Tailwind palette colors here:
   shades such as amber-200 are designed for dark backgrounds and drop to ~1.6:1
   contrast on the light theme's near-white surface. Geometry is fixed so every
   notice across the app reads as the same object. */
export function Notice({
  tone = "neutral",
  icon: Icon,
  children,
  className,
}: {
  tone?: "amber" | "red" | "green" | "neutral"
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      // Errors interrupt; the rest are polite updates.
      role={tone === "red" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
        className,
      )}
      style={{
        color: `var(--status-${tone})`,
        background: `var(--status-${tone}-bg)`,
        borderColor: `var(--status-${tone}-border)`,
      }}
    >
      {Icon ? <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
    </div>
  )
}

/* Single character: digits roll vertically like an odometer */
function RollingChar({ char, height }: { char: string; height: number }) {
  const isDigit = char >= "0" && char <= "9"
  if (!isDigit) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center" style={{ height }}>
        {char}
      </span>
    )
  }
  const n = Number(char)
  return (
    <span className="relative inline-block shrink-0 overflow-hidden tabular-nums" style={{ height, width: "0.6em" }} aria-hidden>
      <span
        className="absolute left-0 top-0 flex flex-col items-center"
        style={{ transform: `translateY(-${n * height}px)`, transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="flex shrink-0 items-center justify-center" style={{ height }}>
            {i}
          </span>
        ))}
      </span>
    </span>
  )
}

/* Animated number that rolls each digit */
export function RollingNumber({ value, height = 16, className }: { value: string; height?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center tabular-nums leading-none", className)}>
      <span className="sr-only">{value}</span>
      {value.split("").map((c, i) => (
        <RollingChar key={i} char={c} height={height} />
      ))}
    </span>
  )
}

/* Collapsible section with icon header + optional count badge.
   onToggle fires with the next open state. */
export function CollapsibleSection({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = true,
  onToggle,
}: {
  title: string
  icon?: LucideIcon
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
  onToggle?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => {
          const next = !current
          onToggle?.(next)
          return next
        })}
        className="zatom-pressable group flex w-full items-center gap-2 rounded-lg py-1 text-left"
      >
        {Icon && (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors"
            style={{ backgroundColor: "var(--panel-elevated)", color: "var(--panel-text-secondary)" }}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
        <SectionLabel>{title}</SectionLabel>
        {typeof count === "number" && (
          <span
            className="rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums"
            style={{ backgroundColor: "var(--panel-elevated)", color: "var(--panel-text-tertiary)" }}
          >
            {count}
          </span>
        )}
        <span className="ml-auto text-[var(--panel-text-tertiary)] transition-colors group-hover:text-[var(--panel-text-secondary)]">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        </span>
      </button>
      {open && <div className="mt-3 flex flex-col gap-3">{children}</div>}
    </div>
  )
}

/* Segmented control (white active pill w/ shadow). bare = text pills, no container. */
export function Segmented({
  options,
  value,
  onChange,
  bare = false,
  ariaLabel = "Options",
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
  bare?: boolean
  ariaLabel?: string
}) {
  if (bare) {
    return (
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {options.map((opt) => {
          const active = opt === value
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (!active) onChange(opt)
              }}
              className="zatom-pressable rounded-lg px-2.5 py-[6px] text-[12px] font-medium"
              style={
                active
                  ? { backgroundColor: "var(--panel-elevated)", color: "var(--panel-text)" }
                  : { backgroundColor: "transparent", color: "var(--panel-text-secondary)" }
              }
            >
              {opt}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <SlidingSegmented
      options={options.map((option) => ({ value: option, label: option }))}
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
    />
  )
}

export interface SlidingSegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

/**
 * Two-way (or small-N) segmented navigation with one physical selection pill.
 * The absolute indicator is local to each instance, so concurrent controls can
 * never share or steal a layout animation from one another.
 */
export function SlidingSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  semantics = "radio",
  tabbable = true,
  selectOnPointerEnter = false,
  gentleMotion = false,
  className,
  getOptionId,
  getPanelId,
}: {
  options: readonly SlidingSegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  semantics?: "tabs" | "radio"
  tabbable?: boolean
  selectOnPointerEnter?: boolean | number
  gentleMotion?: boolean
  className?: string
  getOptionId?: (value: T) => string
  getPanelId?: (value: T) => string | undefined
}) {
  const reduceMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const pointerSelectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const optionCount = Math.max(1, options.length)

  /** Measure the selected pill from rendered segments because flex items can have unequal widths. */
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  const clearPointerSelection = () => {
    if (pointerSelectionTimer.current) clearTimeout(pointerSelectionTimer.current)
    pointerSelectionTimer.current = null
  }

  useEffect(() => clearPointerSelection, [])

  // Use a layout effect so the pill is correct before the first paint.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const measure = () => {
      const target = root
        .querySelectorAll<HTMLButtonElement>('[data-sliding-segment-option]')
        .item(activeIndex)
      if (!target) return
      // offsetLeft is relative to the positioned root and already includes its 3px padding.
      setIndicator({ left: target.offsetLeft, width: target.offsetWidth })
    }

    measure()

    // Observe both the container and segments because panel width and font loading can change geometry.
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    for (const button of root.querySelectorAll('[data-sliding-segment-option]')) {
      observer.observe(button)
    }
    return () => observer.disconnect()
  }, [activeIndex, options])

  const selectAt = (index: number, focus: boolean) => {
    const next = options[index]
    if (!next) return
    if (next.value !== value) {
      onChange(next.value)
    }
    if (focus) {
      requestAnimationFrame(() => {
        rootRef.current
          ?.querySelectorAll<HTMLButtonElement>('[data-sliding-segment-option]')
          .item(index)
          .focus()
      })
    }
  }

  const selectFromPointer = (index: number, pointerType: string) => {
    clearPointerSelection()
    if (!selectOnPointerEnter || pointerType === "touch") return
    const delay = reduceMotion
      ? 0
      : typeof selectOnPointerEnter === "number"
        ? Math.max(0, selectOnPointerEnter)
        : 0
    if (delay === 0) {
      selectAt(index, false)
      return
    }
    pointerSelectionTimer.current = setTimeout(() => {
      pointerSelectionTimer.current = null
      selectAt(index, false)
    }, delay)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % optionCount
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + optionCount) % optionCount
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = optionCount - 1
    if (nextIndex === null) return
    event.preventDefault()
    selectAt(nextIndex, true)
  }

  if (options.length === 0) return null

  return (
    <div
      ref={rootRef}
      role={semantics === "tabs" ? "tablist" : "radiogroup"}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn("relative isolate flex rounded-lg p-[3px]", className)}
      style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}
    >
      {indicator && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[3px] left-0 top-[3px] z-0 rounded-md border"
          style={{
            backgroundColor: "var(--control-selected-bg)",
            borderColor: "var(--control-selected-border)",
            willChange: reduceMotion ? undefined : "transform",
          }}
          initial={false}
          animate={{ x: indicator.left, width: indicator.width }}
          transition={reduceMotion
            ? { duration: 0 }
            : gentleMotion
              ? { type: "spring", stiffness: 250, damping: 27, mass: 0.9 }
              : { type: "spring", stiffness: 460, damping: 29, mass: 0.75 }}
        />
      )}
      {options.map((option, index) => {
        const active = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            id={getOptionId?.(option.value)}
            type="button"
            role={semantics === "tabs" ? "tab" : "radio"}
            aria-selected={semantics === "tabs" ? active : undefined}
            aria-checked={semantics === "radio" ? active : undefined}
            aria-controls={getPanelId?.(option.value)}
            tabIndex={tabbable && active ? 0 : -1}
            data-sliding-segment-option
            onClick={() => { clearPointerSelection(); selectAt(index, false) }}
            onPointerEnter={(event) => selectFromPointer(index, event.pointerType)}
            onPointerLeave={clearPointerSelection}
            onKeyDown={(event) => { clearPointerSelection(); handleKeyDown(event, index) }}
            className="zatom-pressable relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-1 py-1.5 text-[11px] font-medium whitespace-nowrap"
            style={{ color: active ? "var(--control-selected-text)" : "var(--panel-text-secondary)" }}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* Icon-based visual selector (cards with icon + label) */
export function IconSegmented({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: { label: string; icon: LucideIcon }[]
  value: string
  onChange: (v: string) => void
  columns?: number
}) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map(({ label, icon: Icon }) => {
        const active = value === label
        return (
          <button
            key={label}
            type="button"
            data-no-ripple
            data-selected={active}
            onClick={() => {
              if (!active) onChange(label)
            }}
            className="zatom-choice zatom-pressable flex flex-col items-center gap-1.5 rounded-xl px-2 py-2.5"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* Compact semantic switch; theme changes material, not geometry. */
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-selected={checked}
      onClick={() => onChange(!checked)}
      className="zatom-pressable relative h-6 w-10 shrink-0 rounded-md border"
      style={{
        background: checked ? "var(--control-selected-bg)" : "var(--panel-elevated)",
        borderColor: checked ? "var(--control-selected-border)" : "var(--panel-border-focus)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute top-1 h-3.5 w-3.5 rounded-sm transition-transform duration-150"
        style={{
          left: 4,
          background: checked ? "var(--control-selected-text)" : "var(--panel-text-tertiary)",
          transform: checked ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </button>
  )
}

/* Labeled toggle row */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <div>
        <span className="text-[13px] text-[var(--panel-text)]">{label}</span>
        {description && <p className="mt-0.5 text-[10px] text-[var(--panel-text-tertiary)]">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </label>
  )
}

/* Dual-handle range slider with two readout values */
export function RangeSliderRow({
  label,
  min,
  max,
  step,
  value,
  display,
  minLabel,
  maxLabel,
  accent = "var(--panel-accent)",
  onChange,
}: {
  label?: string
  min: number
  max: number
  step: number
  value: [number, number]
  display?: (v: number) => string
  minLabel?: string
  maxLabel?: string
  accent?: string
  onChange: (v: [number, number]) => void
}) {
  const [lo, hi] = value
  const toPct = (v: number) => ((v - min) / (max - min)) * 100
  const loPct = toPct(lo)
  const hiPct = toPct(hi)
  const fmt = display ?? ((v: number) => String(v))
  const setLo = (v: number) => {
    const next = Math.min(v, hi)
    if (next === lo) return
    onChange([next, hi])
  }
  const setHi = (v: number) => {
    const next = Math.max(v, lo)
    if (next === hi) return
    onChange([lo, next])
  }

  return (
    <div>
      {label && (
        <div className="mb-2 flex items-center justify-between">
          <label className="text-[13px] text-[var(--panel-text)]">{label}</label>
          <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white" style={{ backgroundColor: accent }}>
            {fmt(lo)} – {fmt(hi)}
          </span>
        </div>
      )}
      <div className="relative h-5">
        <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full" style={{ backgroundColor: "var(--panel-hover)" }} />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ left: `${loPct}%`, width: `${hiPct - loPct}%`, backgroundColor: accent }} />
        <input
          type="range"
          aria-label={`${label ?? "Range"} minimum`}
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={(e) => setLo(Number(e.target.value))}
          className="zatom-range-thumb"
          style={{ zIndex: lo > max - (max - min) / 20 ? 5 : 3 }}
        />
        <input
          type="range"
          aria-label={`${label ?? "Range"} maximum`}
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={(e) => setHi(Number(e.target.value))}
          className="zatom-range-thumb"
          style={{ zIndex: 4 }}
        />
      </div>
      {(minLabel || maxLabel) && (
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--panel-text-tertiary)]">
          <span className="flex items-center gap-1.5">
            {minLabel}
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
            {maxLabel}
          </span>
        </div>
      )}
    </div>
  )
}

/* Slider row with filled track + stepper readout + drag bubble (rolling number) */
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  accent = "var(--panel-accent)",
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display?: string
  accent?: string
  onChange: (v: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const pct = ((value - min) / (max - min)) * 100
  const clamp = (v: number) => Math.min(max, Math.max(min, Number(v.toFixed(4))))
  const emit = (next: number) => {
    const clamped = clamp(next)
    if (clamped === value) return
    onChange(clamped)
  }
  const dec = () => {
    const next = clamp(value - step)
    if (next === value) return
    onChange(next)
  }
  const inc = () => {
    const next = clamp(value + step)
    if (next === value) return
    onChange(next)
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-[13px] text-[var(--panel-text)]">{label}</label>
        <div
          className="flex items-center gap-0.5 rounded-lg p-0.5 transition-colors"
          style={{ backgroundColor: "var(--panel-elevated)", border: `1px solid ${dragging ? accent : "var(--panel-border)"}` }}
        >
          <button
            type="button"
            onClick={dec}
            disabled={value <= min}
            aria-label={`Decrease ${label}`}
            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--panel-text-secondary)] transition-colors hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)] disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="flex min-w-[34px] justify-center text-[12px] font-medium tabular-nums text-[var(--panel-text)]">
            <RollingNumber value={display ?? value.toFixed(2)} height={15} />
          </span>
          <button
            type="button"
            onClick={inc}
            disabled={value >= max}
            aria-label={`Increase ${label}`}
            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--panel-text-secondary)] transition-colors hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)] disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="relative">
        <div
          className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 transition-[opacity,transform] duration-150"
          style={{ left: `calc(${pct}% + ${8 - pct * 0.16}px)`, opacity: dragging ? 1 : 0, transform: `translateX(-50%) scale(${dragging ? 1 : 0.7})` }}
        >
          <span className="block rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-md" style={{ backgroundColor: accent }}>
            <RollingNumber value={display ?? value.toFixed(2)} height={14} />
          </span>
        </div>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => emit(Number(e.target.value))}
          onPointerDown={() => {
            setDragging(true)
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onBlur={() => setDragging(false)}
          className="zatom-slider"
          style={{ "--slider-fill": `${pct}%`, "--slider-accent": accent } as React.CSSProperties}
        />
      </div>
    </div>
  )
}

export function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[12px]" style={{ color: 'var(--panel-text-secondary)' }}>{label}</span>
      <select
        className="zatom-field min-w-0 max-w-[172px] rounded-lg px-2 py-1.5 text-[11px]"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}
